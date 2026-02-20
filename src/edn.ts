/**
 * Minimal EDN parser — handles the subset spai outputs:
 * maps, vectors, keywords, strings, numbers, nil, booleans.
 * No sets, tagged literals, chars, or ratios.
 */

export type EdnValue =
    | string
    | number
    | boolean
    | null
    | EdnKeyword
    | EdnValue[]
    | EdnMap;

export interface EdnKeyword {
    __kw: string;
}

export interface EdnMap {
    [key: string]: EdnValue;
}

export function kw(name: string): EdnKeyword {
    return { __kw: name };
}

export function isKeyword(v: EdnValue): v is EdnKeyword {
    return v !== null && typeof v === 'object' && '__kw' in v;
}

export function parseEdn(input: string): EdnValue {
    let pos = 0;

    function peek(): string { return input[pos]; }
    function advance(): string { return input[pos++]; }
    function eof(): boolean { return pos >= input.length; }

    function skipWhitespace(): void {
        while (!eof()) {
            const c = peek();
            if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',') {
                advance();
            } else if (c === ';') {
                // Skip comment to end of line
                while (!eof() && peek() !== '\n') { advance(); }
            } else {
                break;
            }
        }
    }

    function readString(): string {
        advance(); // opening "
        let s = '';
        while (!eof() && peek() !== '"') {
            if (peek() === '\\') {
                advance();
                const esc = advance();
                switch (esc) {
                    case 'n': s += '\n'; break;
                    case 't': s += '\t'; break;
                    case '"': s += '"'; break;
                    case '\\': s += '\\'; break;
                    default: s += esc;
                }
            } else {
                s += advance();
            }
        }
        if (!eof()) { advance(); } // closing "
        return s;
    }

    function readSymbolOrKeyword(): EdnValue {
        let s = '';
        while (!eof() && !isDelimiter(peek())) {
            s += advance();
        }
        if (s === 'nil') { return null; }
        if (s === 'true') { return true; }
        if (s === 'false') { return false; }
        // Check if it's a number
        if (/^-?\d+(\.\d+)?$/.test(s)) {
            return parseFloat(s);
        }
        // Keywords start with :
        if (s.startsWith(':')) {
            return kw(s.slice(1));
        }
        // Symbol — return as string
        return s;
    }

    function isDelimiter(c: string): boolean {
        return ' \t\n\r,;()[]{}\"'.includes(c);
    }

    function readVector(): EdnValue[] {
        advance(); // [
        const arr: EdnValue[] = [];
        while (!eof()) {
            skipWhitespace();
            if (eof() || peek() === ']') { break; }
            arr.push(readValue());
        }
        if (!eof()) { advance(); } // ]
        return arr;
    }

    function readList(): EdnValue[] {
        advance(); // (
        const arr: EdnValue[] = [];
        while (!eof()) {
            skipWhitespace();
            if (eof() || peek() === ')') { break; }
            arr.push(readValue());
        }
        if (!eof()) { advance(); } // )
        return arr;
    }

    function readMap(): EdnMap {
        advance(); // {
        const map: EdnMap = {};
        while (!eof()) {
            skipWhitespace();
            if (eof() || peek() === '}') { break; }
            const key = readValue();
            skipWhitespace();
            const val = readValue();
            // Use keyword name or string representation as key
            const keyStr = isKeyword(key) ? key.__kw : String(key);
            map[keyStr] = val;
        }
        if (!eof()) { advance(); } // }
        return map;
    }

    function readValue(): EdnValue {
        skipWhitespace();
        if (eof()) { return null; }
        const c = peek();
        if (c === '{') { return readMap(); }
        if (c === '[') { return readVector(); }
        if (c === '(') { return readList(); }
        if (c === '"') { return readString(); }
        if (c === '#') {
            // Skip tagged literals — read tag, then value
            advance(); // #
            while (!eof() && !isDelimiter(peek())) { advance(); }
            skipWhitespace();
            return readValue();
        }
        return readSymbolOrKeyword();
    }

    return readValue();
}

/** Safely get a string from a parsed EDN map */
export function ednStr(map: EdnMap, key: string): string | null {
    const v = map[key];
    return typeof v === 'string' ? v : null;
}

/** Safely get a number from a parsed EDN map */
export function ednNum(map: EdnMap, key: string): number | null {
    const v = map[key];
    return typeof v === 'number' ? v : null;
}

/** Safely get a keyword value from a parsed EDN map */
export function ednKw(map: EdnMap, key: string): string | null {
    const v = map[key];
    return isKeyword(v) ? v.__kw : null;
}

/** Safely get an array from a parsed EDN map */
export function ednVec(map: EdnMap, key: string): EdnValue[] | null {
    const v = map[key];
    return Array.isArray(v) ? v : null;
}
