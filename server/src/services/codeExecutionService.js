import { env } from "../config/env.js";

const providerRuntime = {
  javascript: { language: "javascript", version: "20.11.1" },
  python: { language: "python", version: "3.12.0" },
  cpp: { language: "c++", version: "10.2.0" },
};
export async function executeInSandbox({ language, sourceCode, stdin }) {
  const runtime = providerRuntime[language];
  const response = await fetch(env.codeExecutionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      language: runtime.language,
      version: runtime.version,
      files: [{ content: sourceCode }],
      stdin,
      compile_timeout: 10000,
      run_timeout: 3000,
      compile_memory_limit: 256000000,
      run_memory_limit: 256000000,
    }),
  });
  if (!response.ok) {
    const message = await response.text();
    const error = new Error(
      `Execution provider error (${response.status}): ${message.slice(0, 300)}`,
    );
    error.statusCode = 502;
    error.expose = true;
    throw error;
  }
  const result = await response.json();
  return {
    stdout: result.run?.stdout ?? "",
    stderr: result.run?.stderr ?? "",
    output: result.run?.output ?? "",
    runtimeMs: result.run?.time ?? 0,
    compileError: result.compile?.stderr ?? "",
    exitCode: result.run?.code,
    signal: result.run?.signal,
  };
}
