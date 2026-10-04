export function notFound(req, res) {
  res
    .status(404)
    .json({ message: `Route not found: ${req.method} ${req.path}` });
}
export function errorHandler(error, req, res, next) {
  console.error(error);
  if (error?.code === 11000)
    return res
      .status(409)
      .json({ message: "A record with that value already exists." });
  if (error?.name === "ZodError")
    return res
      .status(400)
      .json({ message: "Invalid request.", issues: error.issues });
  res
    .status(error.statusCode ?? 500)
    .json({ message: error.expose ? error.message : "Internal server error." });
}
