import { Body, Controller, Get, HttpCode, Inject, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SensitiveRoute } from '../../common/throttling';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig, SESSION_COOKIE } from '../../config/app-config';
import type { AuthContext } from '../../common/auth-context';
import { AllowPendingPassword, CurrentAuth, Public } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { SessionService } from '../../common/security/session.service';
import {
  ChangePasswordDto,
  LoginDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  SignupDto,
  UpdateProfileDto,
} from './auth.dto';
import { AuthService } from './auth.service';
import { type MeResponse, toMe } from './me';

@ApiTags('Authentification')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @SensitiveRoute()
  @Post('signup')
  async signup(
    @Body() dto: SignupDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const token = await this.auth.signup(dto, requestMeta(req));
    return this.openSession(token, res);
  }

  @Public()
  @SensitiveRoute()
  @HttpCode(200)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const token = await this.auth.login(dto, requestMeta(req));
    return this.openSession(token, res);
  }

  @AllowPendingPassword()
  @HttpCode(204)
  @Post('logout')
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(auth);
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  @AllowPendingPassword()
  @Get('me')
  me(@CurrentAuth() auth: AuthContext): MeResponse {
    return toMe(auth);
  }

  @Patch('me')
  @HttpCode(204)
  async updateProfile(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: UpdateProfileDto,
  ): Promise<void> {
    await this.auth.updateProfile(auth, dto);
  }

  @AllowPendingPassword()
  @SensitiveRoute()
  @HttpCode(204)
  @Post('change-password')
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.auth.changePassword(auth, dto);
  }

  @Public()
  @SensitiveRoute()
  @HttpCode(202)
  @Post('password-reset/request')
  async requestReset(
    @Body() dto: PasswordResetRequestDto,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    await this.auth.requestPasswordReset(dto.identifier, requestMeta(req));
    return { message: 'Si un compte correspond, un lien de réinitialisation a été envoyé.' };
  }

  @Public()
  @SensitiveRoute()
  @HttpCode(204)
  @Post('password-reset/confirm')
  async confirmReset(@Body() dto: PasswordResetConfirmDto, @Req() req: Request): Promise<void> {
    await this.auth.confirmPasswordReset(dto, requestMeta(req));
  }

  private async openSession(token: string, res: Response): Promise<MeResponse> {
    res.cookie(SESSION_COOKIE, token, { ...this.cookieOptions(), maxAge: this.sessions.ttlMs });
    const auth = await this.sessions.resolve(token);
    if (!auth) throw new Error('Session créée introuvable.');
    return toMe(auth);
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax' as const,
      path: '/',
    };
  }
}
