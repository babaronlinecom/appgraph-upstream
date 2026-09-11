import Widget from "../components/Widget";
import { fakeDb } from "../lib/fake-db";
import { unusedHelper } from "../lib/helpers";

// A documentation string that looks like an API path but is not a request.
const docsUrl = "https://example.com/api/not-real";
const note = "docs: call /api/not-real for details";

// process.env.NOT_A_REAL_READ only appears in this comment.

export default function HomePage() {
  void docsUrl;
  void note;
  const record = fakeDb.user.create({ name: "example" });
  void record;
  return <main>Home</main>;
}
