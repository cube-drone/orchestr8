/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
    return knex.schema.createTable('table_1', function(table) {
        table.uuid('id').primary();
        table.string('name', 101).nullable();
        table.boolean('verified').defaultTo(false);
        table.date('last_login').nullable();
        table.timestamps();
    })
    .createTable('table_2', function(table) {
        table.increments('id').primary();
        table.uuid('user_id').references('table_1.id').index();
        table.string('config_key', 64).index();
        table.jsonb('config');
        table.timestamps();
    })
  
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
    return knex.schema
        .dropTable('table_1')
        .dropTable('table_2')
  
};
