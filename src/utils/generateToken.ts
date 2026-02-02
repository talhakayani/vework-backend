import jwt from 'jsonwebtoken';

export const generateToken = (id: string): string => {
  const secret: string = process.env.JWT_SECRET || 'secret';
  const expiresIn: string = process.env.JWT_EXPIRE || '7d';
  // @ts-ignore - JWT types issue with expiresIn
  return jwt.sign({ id }, secret, { expiresIn });
};
