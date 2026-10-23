/** 内部用。有限numberの文字列表現を、二進浮動小数の演算をせず十進分数へ変換します。 */
export interface DecimalFraction { numerator: bigint; denominator: bigint; }

export function reduceFraction(numerator: bigint, denominator: bigint): DecimalFraction {
    if (denominator === 0n) throw new Error("分母0の分数です");
    if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
    let a = numerator < 0n ? -numerator : numerator, b = denominator;
    while (b) { const next = a % b; a = b; b = next; }
    return { numerator: numerator / a, denominator: denominator / a };
}

export function decimalFraction(value: number): DecimalFraction {
    if (!Number.isFinite(value)) throw new Error("有限の数値が必要です");
    const [mantissa, exponent = "0"] = String(value).toLowerCase().split("e");
    const [integer, fraction = ""] = mantissa.split(".");
    const coefficient = BigInt(integer + fraction);
    const scale = fraction.length - Number(exponent);
    return scale >= 0 ? reduceFraction(coefficient, 10n ** BigInt(scale))
        : reduceFraction(coefficient * 10n ** BigInt(-scale), 1n);
}

export function compareFractions(a: DecimalFraction, b: DecimalFraction): number {
    const difference = a.numerator * b.denominator - b.numerator * a.denominator;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
