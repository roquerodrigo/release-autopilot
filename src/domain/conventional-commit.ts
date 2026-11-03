const HEADER = /^[\w-]+(?:\([^)]*\))?(?<breakingMark>!)?: /
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE(?:: | #)/m

export function isBreakingCommit(message: string): boolean {
  const groups = HEADER.exec(message)?.groups
  return groups !== undefined && (groups.breakingMark !== undefined || BREAKING_FOOTER.test(message))
}
