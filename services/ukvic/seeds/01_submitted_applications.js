'use strict';

exports.seed = function (knex) {
  // Deletes ALL existing entries
  return knex('submitted_applications').del()
    .then(function () {
      // Inserts seed entries
      return knex('submitted_applications').insert([
        { submission_reference: '1234-1234-1234-1233', session: '{}' },
        { submission_reference: '2468-2468-2468-2460', session: '{}' }
      ]);
    });
};
