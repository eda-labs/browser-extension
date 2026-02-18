import { Box, TextField, Button, Divider, Typography } from '@mui/material';

interface ClientSecretSectionProps {
  clientSecret: string;
  onClientSecretChange: (value: string) => void;
  disabled: boolean;
  locked: boolean;
  edaUrl: string;
  onFetchClick: () => void;
}

export function ClientSecretSection({
  clientSecret,
  onClientSecretChange,
  disabled,
  locked,
  edaUrl,
  onFetchClick,
}: ClientSecretSectionProps) {
  return (
    <>
      <Box sx={{ pt: 1.5 }} />
      <Divider />
      <Typography variant="subtitle2" sx={{ color: 'text.secondary', px: 2, py: 1 }}>
        Client Secret
      </Typography>
      <Divider />
      <Box sx={{ px: 2, pt: 1.5, pb: 0.5, display: 'grid', gap: 1.5 }}>
        <TextField
          label="Client Secret"
          type="password"
          placeholder="Paste or fetch below"
          fullWidth
          value={locked ? '' : clientSecret}
          onChange={(e) => onClientSecretChange(e.target.value)}
          disabled={disabled}
          size="small"
          sx={{ '& input::-ms-reveal, & input::-webkit-credentials-auto-fill-button': { display: 'none' } }}
        />
        <Button
          variant="outlined"
          size="small"
          onClick={onFetchClick}
          disabled={locked || !edaUrl}
        >
          Fetch
        </Button>
      </Box>
    </>
  );
}
