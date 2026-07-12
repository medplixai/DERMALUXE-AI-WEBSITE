// Temporary diagnostic: lists env var NAMES (never values) related to storage.
module.exports = (req, res) => {
  const names = Object.keys(process.env).filter((k) =>
    /KV|UPSTASH|REDIS|STORAGE|ADMIN/i.test(k)
  );
  res.status(200).json({ names });
};
