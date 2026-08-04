const os = require('node:os');
const systemUserInfo = os.userInfo.bind(os);

Object.defineProperty(os, 'userInfo', {
  configurable: true,
  value: (...args) => {
    try {
      return systemUserInfo(...args);
    } catch {
      return {
        uid: -1,
        gid: -1,
        username: process.env.USERNAME || 'klyvo',
        homedir: process.env.USERPROFILE || process.cwd(),
        shell: null,
      };
    }
  },
});
