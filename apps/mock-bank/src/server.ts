import express from "express";
import { router } from "./routes";

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(router);

const PORT = Number(process.env.PORT ?? 4000);

app.listen(PORT, () => {
  console.log(`mock-bank listening on http://localhost:${PORT}`);
});
