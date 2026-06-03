module.exports = {
  apps: [
    {
      name: 'momentos-jyc',
      script: 'server/index.js',
      cwd: '/opt/momentos-jyc',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      out_file: '/var/log/momentos/out.log',
      error_file: '/var/log/momentos/err.log',
      time: true,
    },
  ],
};
