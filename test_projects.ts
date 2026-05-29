import { ProjectsService } from './src/features/projects/projects.service.js';
import { db } from './src/db/index.js';
import { nodes } from './src/db/schema.js';

async function test() {
  const allNodes = await db.select().from(nodes);
  const userNodes = allNodes.filter(n => n.nodeType === 'project');
  if (userNodes.length === 0) {
    console.log("No projects found in DB");
    return;
  }
  const userId = userNodes[0].userId;
  console.log("Testing with userId:", userId);
  const projects = await ProjectsService.getProjects(userId);
  console.log("Projects:", JSON.stringify(projects, null, 2));
}

test().catch(console.error).finally(() => process.exit(0));
