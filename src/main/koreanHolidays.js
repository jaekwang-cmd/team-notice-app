const Holidays = require('date-holidays');

const hd = new Holidays('KR');

function getHolidaysForYear(year) {
  return hd.getHolidays(year)
    .filter((h) => h.type === 'public')
    .map((h) => ({
      date: h.date.slice(0, 10),
      name: h.name,
    }));
}

module.exports = { getHolidaysForYear };
