import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));

test(
	"a clean tarball installs as a Pi package and loads its extension",
	{ timeout: 120_000 },
	async (t) => {
		const directory = await mkdtemp(join(tmpdir(), "modal-pi-package-"));
		t.after(() => rm(directory, { recursive: true, force: true }));
		const { stdout } = await exec(
			"npm",
			["pack", "--json", "--pack-destination", directory],
			{ cwd: root },
		);
		const [pack] = JSON.parse(stdout);
		assert.ok(pack.files.some((file) => file.path === "dist/index.js"));
		assert.ok(pack.files.some((file) => file.path === "dist/pricing.js"));
		assert.ok(
			pack.files.every(
				(file) =>
					!file.path.startsWith("test/") &&
					!file.path.startsWith("node_modules/"),
			),
		);
		const host = join(directory, "host");
		const agent = join(directory, "agent");
		await mkdir(host);
		await mkdir(agent);
		await writeFile(
			join(host, "package.json"),
			JSON.stringify({ private: true, type: "module" }),
		);
		await exec(
			"npm",
			[
				"install",
				"--ignore-scripts",
				"--no-audit",
				"--no-fund",
				join(directory, pack.filename),
				"@earendil-works/pi-ai@1.5.0",
				"@earendil-works/pi-coding-agent@1.5.0",
			],
			{ cwd: host, timeout: 60_000 },
		);
		const cli = join(
			host,
			"node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
		);
		const env = {
			...process.env,
			PI_CODING_AGENT_DIR: agent,
			PI_OFFLINE: "1",
			MODAL_PROXY_TOKEN: "",
		};
		const run = async (args) =>
			exec(process.execPath, args, { cwd: host, env, timeout: 30_000 });
		await run([
			cli,
			"install",
			join(host, "node_modules/@modal-labs/pi-provider"),
		]);
		const settings = JSON.parse(
			await readFile(join(agent, "settings.json"), "utf8"),
		);
		assert.ok(
			settings.packages.some(
				(source) =>
					typeof source === "string" &&
					source.endsWith("@modal-labs/pi-provider"),
			),
		);
		const listed = await run([cli, "list"]);
		assert.match(listed.stdout, /@modal-labs\/pi-provider/);
		const loaded = await run([
			"--input-type=module",
			"-e",
			`
		import assert from "node:assert/strict";
		import modal, { createModalProvider } from "@modal-labs/pi-provider";
		const providers = [];
		await modal({ registerProvider: (provider) => providers.push(provider) });
		assert.equal(providers.length, 1);
		assert.equal(providers[0].id, "modal");
		assert.equal(createModalProvider().id, "modal");
		console.log("PACKAGED_OK");
	`,
		]);
		assert.match(loaded.stdout, /PACKAGED_OK/);
		const license = await readFile(
			join(host, "node_modules/@modal-labs/pi-provider/LICENSE"),
			"utf8",
		);
		assert.match(license, /4\. Redistribution\./);
		assert.match(license, /END OF TERMS AND CONDITIONS/);
		assert.match(license, /Copyright.*Modal Labs/);
	},
);
