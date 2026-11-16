// AI に送る語はコードで定義した技術名に限る。辞書内の誤登録は許可リストにしない。
const SAFE_TECHNOLOGIES = new Set([
  'java', 'javascript', 'typescript', 'python', 'php', 'ruby', 'go', 'rust', 'kotlin', 'swift',
  'c', 'c++', 'c#', '.net', 'scala', 'sql', 'html', 'css', 'react', 'vue', 'angular',
  'next.js', 'node.js', 'spring', 'spring boot', 'django', 'flask', 'rails', 'laravel',
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'linux', 'windows',
  'postgresql', 'mysql', 'oracle', 'redis', 'mongodb', 'git', 'github', 'gitlab',
  'jenkins', 'circleci', 'ansible', 'salesforce', 'sap', 'tableau', 'power bi',
]);

export function isSafeIntakeSkill(value: string): boolean {
  return SAFE_TECHNOLOGIES.has(value.normalize('NFKC').trim().toLocaleLowerCase('en-US'));
}
