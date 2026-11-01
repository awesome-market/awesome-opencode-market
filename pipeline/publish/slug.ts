/** Slug rules (DEV §4.6): owner/repo canonical; npm-only → @scope/name; immutable once minted. */

export function slugOf(opts: { repo?: string | undefined; npmName?: string | undefined; subpath?: string | undefined }): string {
  if (opts.repo) {
    const base = opts.repo.replace(/^@/, '').toLowerCase()
    if (opts.subpath) return `${base}--${opts.subpath.replace(/\//g, '-')}`
    return base
  }
  if (opts.npmName) return opts.npmName.toLowerCase()
  throw new Error('slugOf: need repo or npmName')
}
