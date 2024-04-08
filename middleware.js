function loggingMiddleware(req, res, next) {
    // Get current timestamp
    const timestamp = new Date().toISOString();

    // Log IP address of the client
    const ip = req.ip || req.connection.remoteAddress;

    // Log endpoint
    const endpoint = req.path;

    // Log request method
    const method = req.method;

    // Log request body (data/params)
    const requestBody = req.body;

    // Log query parameters
    const queryParams = req.query;

    // Log request headers
    const headers = req.headers;

    // Log all details
    console.log(`[${timestamp}] ${method} ${endpoint} - IP: ${ip}`);
    console.log(`Request Body: ${JSON.stringify(requestBody)}`);
    console.log(`Query Parameters: ${JSON.stringify(queryParams)}`);
    // console.log(`Headers: ${JSON.stringify(headers)}`);

    // Proceed to the next middleware
    next();
}

module.exports = loggingMiddleware;
