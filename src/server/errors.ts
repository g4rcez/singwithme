/** An error whose message is safe to show to the person using the app. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
