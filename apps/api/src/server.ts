import { APP_NAME } from '@mbc/shared';

import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 4000);

createApp().listen(port, () => {
  console.log(`${APP_NAME} api listening on http://localhost:${port}`);
});
