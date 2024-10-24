"use strict";

const fastify = require('fastify')({ logger: true });
const path = require('path');
const AutoLoad = require('@fastify/autoload');
require('dotenv').config();

async function start() {
  try {
    // Register plugins
    fastify.register(AutoLoad, {
      dir: path.join(__dirname, 'plugins'),
      options: {}
    });

    // Register routes
    fastify.register(AutoLoad, {
      dir: path.join(__dirname, 'routes'),
      options: {}
    });

    // Start the server
    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    console.log(`Server listening on ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
