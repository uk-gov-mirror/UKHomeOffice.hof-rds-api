exports.up = async (knex) => {
  return await knex.schema.raw(`ALTER SEQUENCE applicants_applicant_id_seq RESTART WITH 20000`);
};

exports.down = function() {};
