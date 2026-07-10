import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';

type SourceType = 'TASK' | 'PROJECT';

@Injectable()
export class IndexingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  toVectorLiteral(vector: number[]) {
    if (
      vector.length !== 1536 ||
      !vector.every((value) => Number.isFinite(value))
    ) {
      throw new Error('Embedding vector must contain 1536 finite numbers.');
    }

    return `[${vector.map((value) => Number(value).toFixed(8)).join(',')}]`;
  }

  async indexDocument(input: {
    organizationId: string;
    chunkKey: string;
    sourceType: SourceType;
    sourceId: string;
    content: string;
    sourceLabel?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    const embedding = await this.embeddingService.generateEmbedding(
      input.content,
    );
    const vectorLiteral = this.toVectorLiteral(embedding);
    const metadata = JSON.stringify(input.metadata ?? {});

    await this.prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "document_embeddings" (
          "organizationId",
          "chunkKey",
          "sourceType",
          "sourceId",
          "sourceLabel",
          "content",
          "metadata",
          "embedding",
          "isDeleted",
          "deletedAt",
          "updatedAt"
        )
        VALUES (
          ${input.organizationId},
          ${input.chunkKey},
          ${input.sourceType},
          ${input.sourceId},
          ${input.sourceLabel ?? null},
          ${input.content},
          CAST(${metadata} AS jsonb),
          CAST(${vectorLiteral} AS vector),
          false,
          null,
          NOW()
        )
        ON CONFLICT ("chunkKey")
        DO UPDATE SET
          "organizationId" = EXCLUDED."organizationId",
          "sourceType" = EXCLUDED."sourceType",
          "sourceId" = EXCLUDED."sourceId",
          "sourceLabel" = EXCLUDED."sourceLabel",
          "content" = EXCLUDED."content",
          "metadata" = EXCLUDED."metadata",
          "embedding" = EXCLUDED."embedding",
          "isDeleted" = false,
          "deletedAt" = null,
          "updatedAt" = NOW()
      `,
    );
  }

  async indexTasksData(organizationId: string) {
    await this.softDeleteSourceDocuments(organizationId, 'TASK');

    const tasks = await this.prisma.task.findMany({
      where: {
        organizationId,
      },
      orderBy: {
        updatedAt: 'desc',
      },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        tags: true,
        deadline: true,
        estimatedHours: true,
        createdAt: true,
        updatedAt: true,
        project: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        assignee: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
        reporter: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
      },
    });

    for (const task of tasks) {
      await this.indexDocument({
        organizationId,
        chunkKey: `task-${task.id}`,
        sourceType: 'TASK',
        sourceId: task.id,
        sourceLabel: task.title,
        content: this.buildTaskContent(task),
        metadata: {
          taskId: task.id,
          status: task.status,
          priority: task.priority,
          tags: task.tags,
          projectId: task.project?.id,
          projectName: task.project?.name,
          assigneeId: task.assignee?.id,
          reporterId: task.reporter.id,
        },
      });
    }

    return {
      success: true,
      message: 'Tasks indexed successfully.',
      indexedCount: tasks.length,
    };
  }

  async indexProjectsData(organizationId: string) {
    await this.softDeleteSourceDocuments(organizationId, 'PROJECT');

    const projects = await this.prisma.project.findMany({
      where: {
        organizationId,
        status: {
          not: 'ARCHIVED',
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        status: true,
        startDate: true,
        endDate: true,
        createdAt: true,
        updatedAt: true,
        owner: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
        team: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        _count: {
          select: {
            members: true,
            tasks: true,
          },
        },
      },
    });

    for (const project of projects) {
      await this.indexDocument({
        organizationId,
        chunkKey: `project-${project.id}`,
        sourceType: 'PROJECT',
        sourceId: project.id,
        sourceLabel: project.name,
        content: this.buildProjectContent(project),
        metadata: {
          projectId: project.id,
          slug: project.slug,
          status: project.status,
          ownerId: project.owner.id,
          teamId: project.team?.id,
          memberCount: project._count.members,
          taskCount: project._count.tasks,
        },
      });
    }

    return {
      success: true,
      message: 'Projects indexed successfully.',
      indexedCount: projects.length,
    };
  }

  private buildTaskContent(task: {
    title: string;
    description: string | null;
    status: string;
    priority: string;
    tags: string[];
    deadline: Date | null;
    estimatedHours: number | null;
    project: { name: string; slug: string } | null;
    assignee: {
      firstName: string;
      lastName: string;
      displayName: string | null;
      email: string;
    } | null;
    reporter: {
      firstName: string;
      lastName: string;
      displayName: string | null;
      email: string;
    };
  }) {
    return [
      `Task: ${task.title}`,
      task.description ? `Description: ${task.description}` : undefined,
      `Status: ${task.status}`,
      `Priority: ${task.priority}`,
      task.tags.length ? `Tags: ${task.tags.join(', ')}` : undefined,
      task.project
        ? `Project: ${task.project.name} (${task.project.slug})`
        : undefined,
      task.assignee
        ? `Assignee: ${this.formatPerson(task.assignee)}`
        : 'Assignee: Unassigned',
      `Reporter: ${this.formatPerson(task.reporter)}`,
      task.deadline ? `Deadline: ${task.deadline.toISOString()}` : undefined,
      task.estimatedHours
        ? `Estimated hours: ${task.estimatedHours}`
        : undefined,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async softDeleteSourceDocuments(
    organizationId: string,
    sourceType: SourceType,
  ) {
    await this.prisma.$executeRaw(
      Prisma.sql`
        UPDATE "document_embeddings"
        SET
          "isDeleted" = true,
          "deletedAt" = NOW(),
          "updatedAt" = NOW()
        WHERE "organizationId" = ${organizationId}
          AND "sourceType" = ${sourceType}
      `,
    );
  }

  private buildProjectContent(project: {
    name: string;
    slug: string;
    description: string | null;
    status: string;
    startDate: Date | null;
    endDate: Date | null;
    owner: {
      firstName: string;
      lastName: string;
      displayName: string | null;
      email: string;
    };
    team: { name: string; slug: string } | null;
    _count: { members: number; tasks: number };
  }) {
    return [
      `Project: ${project.name}`,
      `Slug: ${project.slug}`,
      project.description ? `Description: ${project.description}` : undefined,
      `Status: ${project.status}`,
      `Owner: ${this.formatPerson(project.owner)}`,
      project.team
        ? `Team: ${project.team.name} (${project.team.slug})`
        : undefined,
      `Members: ${project._count.members}`,
      `Tasks: ${project._count.tasks}`,
      project.startDate
        ? `Start date: ${project.startDate.toISOString()}`
        : undefined,
      project.endDate
        ? `End date: ${project.endDate.toISOString()}`
        : undefined,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private formatPerson(person: {
    firstName: string;
    lastName: string;
    displayName: string | null;
    email: string;
  }) {
    return `${person.displayName ?? `${person.firstName} ${person.lastName}`} <${person.email}>`;
  }
}
