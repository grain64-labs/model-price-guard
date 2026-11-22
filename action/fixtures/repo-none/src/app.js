// A repo with no LLM model ids: the words auto, model and gpt alone are not ids.
const model = process.env.MODEL || "auto";
console.log("gpt", model);
