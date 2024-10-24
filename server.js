// server.js
"use strict";

const path = require("path");
const AutoLoad = require("@fastify/autoload");
require("dotenv").config();

module.exports = async function (fastify, opts) {
  // Register plugins
  fastify.register(AutoLoad, {
    dir: path.join(__dirname, "plugins"),
    options: Object.assign({}, opts),
  });

  // Register routes
  fastify.register(AutoLoad, {
    dir: path.join(__dirname, "routes"),
    options: Object.assign({}, opts),
  });
};

module.exports.options = {
  trustProxy: true,
};
