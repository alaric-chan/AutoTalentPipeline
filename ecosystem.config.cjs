module.exports = {
  apps: [
    {
      name: 'leai-recruiting',
      script: 'server/index.js',
      cwd: '/opt/projects/leai-recruiting',
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: '4317',
        APP_BASE_URL: 'https://new.leaibot.cn/recruiting',
        LARK_CLI_PATH: '/opt/node22/bin/lark-cli'
      }
    }
  ]
};
