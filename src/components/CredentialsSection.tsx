import { Box, TextField, Divider, Typography } from '@mui/material';

interface CredentialsSectionProps {
  username: string;
  password: string;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  disabled: boolean;
  locked: boolean;
}

export function CredentialsSection({
  username,
  password,
  onUsernameChange,
  onPasswordChange,
  disabled,
  locked,
}: CredentialsSectionProps) {
  return (
    <>
      <Box sx={{ pt: 1.5 }} />
      <Divider />
      <Typography variant="subtitle2" sx={{ color: 'text.secondary', px: 2, py: 1 }}>
        EDA User
      </Typography>
      <Divider />
      <Box sx={{ px: 2, pt: 1.5, pb: 0.5, display: 'grid', gap: 1.5 }}>
        <TextField
          label="Username"
          placeholder="EDA Username"
          fullWidth
          value={username}
          onChange={(e) => onUsernameChange(e.target.value)}
          disabled={disabled}
          size="small"
        />
        <TextField
          label="Password"
          type="password"
          placeholder="EDA User Password"
          fullWidth
          value={locked ? '' : password}
          onChange={(e) => onPasswordChange(e.target.value)}
          disabled={disabled}
          size="small"
          sx={{ '& input::-ms-reveal, & input::-webkit-credentials-auto-fill-button': { display: 'none' } }}
        />
      </Box>
    </>
  );
}
