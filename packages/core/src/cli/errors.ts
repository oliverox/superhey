export class HeyCliError extends Error {
  constructor(
    message: string,
    readonly code: string = 'cli_error',
    readonly exitCode: number | null = null,
    readonly stderr = '',
  ) {
    super(message)
    this.name = 'HeyCliError'
  }
}

/** The CLI has no usable login. The user must run `hey auth login`; the app never does. */
export class HeyAuthError extends HeyCliError {
  constructor(message = 'HEY CLI is not signed in. Run `hey auth login` in a terminal.') {
    super(message, 'auth', 3)
    this.name = 'HeyAuthError'
  }
}

export class HeyNotFoundError extends HeyCliError {
  constructor(message = 'resource not found') {
    super(message, 'not_found')
    this.name = 'HeyNotFoundError'
  }
}

/** No HEY CLI binary found, or the one found is not the HEY CLI. */
export class HeyBinaryError extends HeyCliError {
  constructor(message: string) {
    super(message, 'binary')
    this.name = 'HeyBinaryError'
  }
}
