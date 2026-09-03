module.exports = {
  apps: [
    {
      name: 'beihuochuhuojihua',
      script: 'server/app.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 4009,
        DATA_DIR: process.env.DATA_DIR || './data'
      },
      max_memory_restart: '1G'
    }
  ]
};
