import { app } from './app.js';
import { env } from './config/env.js';
app.listen(env.PORT, () => {
    console.log(`🚀 AION Backend running on port ${env.PORT}`);
});
//# sourceMappingURL=index.js.map