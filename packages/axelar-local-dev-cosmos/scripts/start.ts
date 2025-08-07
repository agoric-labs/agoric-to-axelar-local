import { startChains } from "../src/setup";

startChains().catch(err => {
  console.log(err);
  throw err;
});
