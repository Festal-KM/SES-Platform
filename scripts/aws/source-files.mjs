/** 認証処理のソースは保持し、認証情報・生成物をAWSへのソース転送から除く。 */
export function isExcludedSource(file) {
  return /(^|\/)(node_modules|\.next|dist|coverage|test-results|\.git)(\/|$)/.test(file)
    || (/(^|\/)\.env/.test(file) && file !== '.env.example')
    || /\.(pem|key|p12|pfx)$|(^|\/)(credentials|\.runtime\.env)$/i.test(file);
}
