export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const unauthorized = () => new ApiError(401, "AUTH_REQUIRED", "Authentication required");
export const forbidden = () => new ApiError(403, "AUTH_FORBIDDEN", "Access denied");
export const notFound = (resource = "Resource") => new ApiError(404, "RESOURCE_NOT_FOUND", `${resource} not found`);
