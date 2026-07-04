import "dotenv/config";
import { runZarukuWgdProductionPipeline } from "../src/features/seoAgent/production/zaruku/zarukuWgdProductionPipeline";

runZarukuWgdProductionPipeline()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode || 0), 250);
  });
