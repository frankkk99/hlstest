module.exports = {
  apps: [
    {
      name: "dev2u-player-gateway",
      cwd: __dirname,
      script: ".next/standalone/server.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      time: true,
      max_memory_restart: "1400M",
      kill_timeout: 15000,
      listen_timeout: 15000,
      env: {
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: "3000"
      }
    }
  ]
};
