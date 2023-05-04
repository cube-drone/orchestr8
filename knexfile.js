// Update with your config settings.
const postgresConnectionString = process.env.TEMPL8_POSTGRES_URL || process.env.POSTGRES_URL || 
    "postgres://postgres:example@localhost:5432/templ8";

/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
module.exports = {

  development: {
    client: 'postgresql',
    connection: postgresConnectionString,
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations'
    }
  },

  production: {
    client: 'postgresql',
    connection: postgresConnectionString,
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations'
    }
  }

};
