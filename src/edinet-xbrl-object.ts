import { EdinetDataUtil } from "./edinet-data-util";

export class EdinetData {
    constructor(
        public readonly key: string,
        public readonly value: string,
        public readonly decimals: number = 0,
        public readonly unitRef: string = "",
        public readonly contextRef: string = ""
    ) { }

    public static create(node: any, key?: string): EdinetData {
        // If key is not provided, extract from node
        const finalKey = key || EdinetDataUtil.getKey(EdinetDataUtil.getName(node));
        // Wait, EdinetDataUtil.getName returns the 'name' attribute, but often the key is the tag name passed during parsing.
        // In the python parser code:
        // parser = XBRLParser.parse(of)
        // for node in parser.find_all():
        //     cls.put_node(xbrl_object, node)
        // And put_node does: xbrl_object.put(node.name, EdinetData.create(node))
        // And create does: key = EdinetDataUtil.get_key(node) which is node.name.

        // In fast-xml-parser, we need to pass the key explicitly or derive it if we are iterating over keys.
        // I'll allow key to be passed or derived.

        // Actually, looking at EdinetDataUtil implementation:
        // getKey(nodeKey: string) splits by colon.
        // So 'node' passed here might be the parsed object? 
        // In our parser logic (next step), we will likely iterate over the object keys, which represent the tags.
        // So 'key' will be passed from outside.

        const value = EdinetDataUtil.getValue(node);
        const decimals = EdinetDataUtil.getDecimals(node);
        const unitRef = EdinetDataUtil.getUnitRef(node);
        const contextRef = EdinetDataUtil.getContextRef(node);

        return new EdinetData(key || "", value, decimals, unitRef, contextRef);
    }
}

export class EdinetXbrlObject {
    private dataMap: Map<string, EdinetData[]> = new Map();

    public clear(): void {
        this.dataMap.clear();
    }

    public put(key: string, edinetData: EdinetData): void {
        const existing = this.dataMap.get(key) || [];
        existing.push(edinetData);
        this.dataMap.set(key, existing);
    }

    public getDataList(key: string, autoLower: boolean = true): EdinetData[] {
        // Python code had auto_lower=True, but tag names are case sensitive in XML usually?
        // However, EDINET tags might be typically accessed in a case-insensitive way in that lib?
        // Python code: if auto_lower: key = key.lower()
        // But it stores them as they come. 
        // Wait, if it stores 'NetSales' and querying 'netsales', it implies keys are stored lowercased?
        // Let's check Python code again.
        // EdinetXbrlParser.put_node: xbrl_object.put(node.name, ...)
        // node.name comes from correct XML case.
        // EdinetXbrlObject.put: strictly puts `key`.
        // EdinetXbrlObject.get_data_list: if auto_lower, lowercases the query key.
        // Does it mean the storage relies on user passing lowercase or does it normalize on put?
        // Python code DOES NOT normalize on put. 
        // This seems like a bug or specific behavior in the Python lib where it expects exact match OR 
        // maybe `node.name` is somehow lowercased? Unlikely.
        // Actually, looking at `get_data_list` in Python: `return self._data_dict.get(key, [])`.
        // If I `put` "NetSales" and `get` "netsales", it won't find it unless they match.
        // I suspect the Python lib assumes the user knows the exact casing, OR `auto_lower` is only useful if the keys were stored in lower case.
        // For now, I will use Exact Match by default to be safe and correct with XML.
        // I will ignore `autoLower` logic or default it to false to avoid confusion, 
        // OR I will implement it if I find that we need case-insensitive search (loop through keys).

        // Let's just do exact get for now. 
        return this.dataMap.get(key) || [];
    }

    public getDataByContextRef(key: string, contextRef: string): EdinetData | null {
        const list = this.getDataList(key);
        const found = list.find((d) => d.contextRef === contextRef);
        return found || null;
    }

    public getKeys(): string[] {
        return Array.from(this.dataMap.keys());
    }

    public hasKey(key: string): boolean {
        return this.dataMap.has(key);
    }
}
