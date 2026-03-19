module.exports = {
  apps: [
    {
      name: 'skill-manager-3456',
      cwd: __dirname,
      script: 'server.js',
      interpreter: 'node',
      env: { NODE_ENV: 'production' }
    }
  ]
}
