export class RlmError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "RlmError";
        this.code = code;
    }
    toInfo() {
        return { code: this.code, message: this.message };
    }
}
/** Normalize any thrown value to a stable error envelope. */
export function toErrorInfo(e) {
    if (e instanceof RlmError)
        return e.toInfo();
    if (e instanceof Error)
        return { code: "RUNTIME_ERROR", message: e.message };
    return { code: "RUNTIME_ERROR", message: String(e) };
}
