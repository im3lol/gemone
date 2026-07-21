import { IsIn, IsInt, IsString, MinLength, Min } from 'class-validator';

export const WITHDRAWAL_METHODS = ['paypal', 'amazon', 'visa', 'googleplay'] as const;

export class CreateWithdrawalDto {
  @IsIn(WITHDRAWAL_METHODS)
  method!: (typeof WITHDRAWAL_METHODS)[number];

  @IsString()
  @MinLength(3)
  destination!: string; // payout email / account handle

  @IsInt()
  @Min(1)
  points!: number;
}
