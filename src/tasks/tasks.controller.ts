import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TenantAccess } from '../common/decorators/tenant-access.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantAccessGuard } from '../common/guards/tenant-access.guard';
import {
  assignTaskSchema,
  createTaskSchema,
  listTasksQuerySchema,
  parseWithSchema,
  resourceIdValue,
  updateTaskSchema,
  updateTaskStatusSchema,
} from './tasks.schemas';
import { TasksService } from './tasks.service';

@Controller('tasks')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
@TenantAccess()
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  createTask(@CurrentUser() currentUser: JwtUser, @Body() body: unknown) {
    return this.tasksService.createTask(
      currentUser,
      parseWithSchema(createTaskSchema, body),
    );
  }

  @Get()
  listTasks(@CurrentUser() currentUser: JwtUser, @Query() query: unknown) {
    return this.tasksService.listTasks(
      currentUser,
      parseWithSchema(listTasksQuerySchema, query),
    );
  }

  @Get('my')
  getMyTasks(@CurrentUser() currentUser: JwtUser, @Query() query: unknown) {
    return this.tasksService.getMyTasks(
      currentUser,
      parseWithSchema(listTasksQuerySchema, query),
    );
  }

  @Get(':taskId')
  getTask(
    @CurrentUser() currentUser: JwtUser,
    @Param('taskId') taskId: string,
  ) {
    return this.tasksService.getTask(
      currentUser,
      parseWithSchema(resourceIdValue, taskId),
    );
  }

  @Get(':taskId/assignment-suggestions')
  getAssignmentSuggestions(
    @CurrentUser() currentUser: JwtUser,
    @Param('taskId') taskId: string,
  ) {
    return this.tasksService.getAssignmentSuggestions(
      currentUser,
      parseWithSchema(resourceIdValue, taskId),
    );
  }

  @Patch(':taskId')
  updateTask(
    @CurrentUser() currentUser: JwtUser,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ) {
    return this.tasksService.updateTask(
      currentUser,
      parseWithSchema(resourceIdValue, taskId),
      parseWithSchema(updateTaskSchema, body),
    );
  }

  @Patch(':taskId/status')
  updateTaskStatus(
    @CurrentUser() currentUser: JwtUser,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ) {
    return this.tasksService.updateTaskStatus(
      currentUser,
      parseWithSchema(resourceIdValue, taskId),
      parseWithSchema(updateTaskStatusSchema, body),
    );
  }

  @Patch(':taskId/assign')
  assignTask(
    @CurrentUser() currentUser: JwtUser,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ) {
    return this.tasksService.assignTask(
      currentUser,
      parseWithSchema(resourceIdValue, taskId),
      parseWithSchema(assignTaskSchema, body),
    );
  }

  @Delete(':taskId')
  deleteTask(
    @CurrentUser() currentUser: JwtUser,
    @Param('taskId') taskId: string,
  ) {
    return this.tasksService.deleteTask(
      currentUser,
      parseWithSchema(resourceIdValue, taskId),
    );
  }
}
