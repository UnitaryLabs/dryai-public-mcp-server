import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const DRY_URL_QA_BASE = "http://velocity-local.dry:8080/api/dryqa";
const DRY_AI_GET_TOOLS_URL = "http://velocity-local.dry:8080/api/gtpb"; // Define the URL as a constant

const USER_AGENT = "dry-app/1.0";
// Context from the auth process, encrypted & stored in the auth token
// and provided to the MyMCP as this.props
type Props = {
	smartspace: string;
	dryToken: string
};
interface DryResponse {
	dryContext?: string;
	success?: boolean;
}

interface DryRequest {
	smartspace?: string;
	user?: string;
	query?: string;
	type?: string;
}

// Helper function for making NWS API requests
async function makeDryRequest<RequestType, ResponseType>(url: string, data: RequestType): Promise<ResponseType | null> {
	const headers = {
		"User-Agent": USER_AGENT,
		Accept: "application/json",
		"Content-Type": "application/json",
	};

	try {
		const response = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(data),
		});
		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}
		return (await response.json()) as ResponseType;
	} catch (error) {
		console.error("Error making Dry request:", error);
		return null;
	}
}

async function loadToolsFromJson(smartspace: string, dryToken: string, server: McpServer) {
	try {
		console.log("Loading tools from dry.ai: " + smartspace);
		console.log("Loading tools from dry.ai: " + dryToken);
		// Make the API request to fetch tools
		const response = await fetch(`${DRY_AI_GET_TOOLS_URL}?ss=${encodeURIComponent(smartspace)}`, {
			method: "GET",
			headers: {
				"Authorization": `Bearer ${dryToken}`,
				"Content-Type": "application/json",
			}
		});
		// Check if the response is successful
		if (!response.ok) {
			console.error(`Failed to fetch tools: ${response.status} ${response.statusText}`);
			return;
		}

		const dryTools = JSON.parse(JSON.stringify(await response.json()));

		if (dryTools.smartspaces && dryTools.smartspaces.length > 0) {
			dryTools.smartspaces.forEach((tool: any) => {

				server.tool(
					tool.name,
					tool.description,
					{
						query: z.string().describe(tool.schemaDescription),
					},
					async ({ query }) => {
						const dryUrl = DRY_URL_QA_BASE;
						const dryData: DryRequest = {
							user: dryTools.user,
							smartspace: tool.smartspace,
							query: query,
							type: tool.type
						};
						const dryResponse = await makeDryRequest<DryRequest, DryResponse>(dryUrl, dryData);

						if (!dryResponse) {
							return {
								content: [
									{
										type: "text",
										text: `Failed to get information for the query: ${query}.`
									}
								]
							};
						}

						return {
							content: [
								{
									type: "text",
									text: dryResponse.dryContext || `No context found for the query: ${query}.`
								}
							]
						};
					}
				);
			});
		}
	} catch (error) {
		console.error("Error loading tools from JSON:", error);
	}
}
// Define our MCP agent with tools
export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "Dry.ai Public MCP Server",
		version: "1.0.0",
	});

	async init() {
		const dryToken = this.props.dryToken as string;
		const smartspace = this.props.smartspace as string;

		await loadToolsFromJson(smartspace, dryToken, this.server);
	}
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		ctx.props.dryToken = env.DRY_AUTH_KEY || ""; // Set from DRY_AUTH_KEY environment variable
		ctx.props.smartspace = url.searchParams.get("ss") || ""; // Set from the 'ss' query parameter

		if (url.pathname === "/sse" || url.pathname === "/sse/message" || url.pathname.endsWith("/sse")) {
			// @ts-ignore
			return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		if (url.pathname === "/mcp") {
			// @ts-ignore
			return MyMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};
