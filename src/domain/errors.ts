export class InvalidConfigurationError extends Error {
  override name = 'InvalidConfigurationError'
}

export class RejectedNotesError extends Error {
  override name = 'RejectedNotesError'
}

export class ReleaseVersionConflictError extends Error {
  override name = 'ReleaseVersionConflictError'
}
