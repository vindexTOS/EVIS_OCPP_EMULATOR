import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private locked = false;

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly jwt: JwtService,
  ) {}

  /** Locked means: a user exists, so the API needs a token. */
  async isLocked(): Promise<boolean> {
    if (this.locked) return true;
    this.locked = (await this.users.count()) > 0;
    return this.locked;
  }

  /** Check a token outside the HTTP guard (the Socket.IO handshake). */
  async verify(token: string | undefined): Promise<boolean> {
    if (!(await this.isLocked())) return true;
    if (!token) return false;
    try {
      await this.jwt.verifyAsync(token);
      return true;
    } catch {
      return false;
    }
  }

  async register(dto: RegisterDto) {
    if (await this.isLocked()) {
      throw new ConflictException('This instance is already locked.');
    }
    const email = dto.email.toLowerCase().trim();
    const password = await bcrypt.hash(dto.password, 10);
    const user = await this.users.save(this.users.create({ email, password }));
    this.locked = true;
    return this.issueToken(user);
  }

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase().trim();
    const user = await this.users.findOneBy({ email });
    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    return this.issueToken(user);
  }

  private issueToken(user: User) {
    const sub = String(user.id);
    return {
      accessToken: this.jwt.sign({ sub, email: user.email }),
      user: { id: sub, email: user.email },
    };
  }
}
