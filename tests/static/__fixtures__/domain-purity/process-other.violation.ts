// 違反: process.env 以外の process.* 参照も検査対象（`process.*`）。
export function exitCode(): unknown {
  return process.exitCode;
}
