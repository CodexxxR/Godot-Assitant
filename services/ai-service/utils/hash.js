const crypto = require("crypto");

const sha1 = (value) => crypto.createHash("sha1").update(value).digest("hex");

module.exports = { sha1 };
