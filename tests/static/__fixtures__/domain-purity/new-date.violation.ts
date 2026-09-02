// 違反: new Date() で現在時刻を内部で読んでいる（docs/05 §2.2「now: Date を引数で受ける」に反する）。
export function currentDeadline(): Date {
  return new Date();
}
