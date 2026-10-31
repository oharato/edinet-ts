#!/usr/bin/env python3
"""Wait on the actual Linux process handle, then run fixed verification tools sequentially."""
import argparse, hashlib, json, os, pathlib, select, shutil, signal, subprocess, sys, time

def main():
    parser = argparse.ArgumentParser()
    for name in ('pid', 'sdk', 'run', 'node', 'output'):
        parser.add_argument('--' + name, required=True, type=int if name == 'pid' else str)
    parser.add_argument('--result', default='batch-002.json', help='Build result filename within --run')
    args = parser.parse_args()
    if pathlib.Path(args.result).name != args.result or args.result in ('.', '..'):
        parser.error('--result must be a filename within --run')
    run, sdk, output = map(lambda p: pathlib.Path(p).resolve(), (args.run, args.sdk, args.output))
    handle = os.pidfd_open(args.pid)  # Exact process identity, including after exit; no PID reuse polling.
    try:
        output.mkdir(mode=0o700)
        tools = output / 'tools'; tools.mkdir(mode=0o700)
        scripts = pathlib.Path(__file__).resolve().parent
        names = ['verify-duck-financial-direct.mjs', 'verify-duck-financial-raw.mjs', 'benchmark-duck-financial-cycle.mjs']
        fingerprints = {}
        for name in names:
            shutil.copyfile(scripts / name, tools / name)
            fingerprints[name] = hashlib.sha256((tools / name).read_bytes()).hexdigest()
        shutil.copyfile(__file__, tools / pathlib.Path(__file__).name)
        fingerprints[pathlib.Path(__file__).name] = hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
        state = dict(status='waiting-for-build', pid=args.pid, sdk=str(sdk), run=str(run), result=args.result, toolsSha256=fingerprints, stages=[])
        def save():
            temp = output / 'status.tmp'; temp.write_text(json.dumps(state, indent=2) + '\n'); temp.replace(output / 'status.json')
        def stop(_signum, _frame):
            raise KeyboardInterrupt()
        signal.signal(signal.SIGTERM, stop)
        save(); poll = select.poll(); poll.register(handle, select.POLLIN)
        while not poll.poll(1000):
            pass
        built = json.loads((run / args.result).read_text())
        if built.get('status') != 'built':
            state['status'] = 'build-not-complete'; save(); return 1
        for name, stage in zip(names, ['direct', 'raw', 'reader']):
            state['status'] = 'running-' + stage; save(); started = time.time()
            with (output / (stage + '.stdout')).open('wb') as stdout, (output / (stage + '.stderr')).open('wb') as stderr:
                child = subprocess.Popen(['/usr/bin/time', '-v', '-o', str(output / (stage + '-resource.txt')), args.node, str(tools / name), str(sdk), str(run / 'candidate'), str(output / stage)], stdout=stdout, stderr=stderr, start_new_session=True)
                try:
                    exit_code = child.wait()
                except BaseException:
                    os.killpg(child.pid, signal.SIGTERM)
                    try:
                        child.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL); child.wait()
                    raise
            state['stages'].append(dict(stage=stage, exitCode=exit_code, elapsedSeconds=time.time()-started))
            if exit_code:
                state['status'] = 'failed-' + stage; save(); return 1
            assert (output / stage / 'summary.json').is_file()
        state['status'] = 'validation-finished-not-publication-approved'; save(); return 0
    except BaseException as error:
        if 'state' in locals():
            state['status'] = 'stopped'; state['errorType'] = type(error).__name__; save()
        raise
    finally:
        os.close(handle)

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(type(error).__name__ + ': ' + str(error), file=sys.stderr)
        sys.exit(1)
