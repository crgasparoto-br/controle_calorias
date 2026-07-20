import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Save } from "lucide-react";

type Props = {
  displayName: string;
  registrationNumber: string;
  contactEmail: string;
  contactPhone: string;
  patientFacingBio: string;
  saving: boolean;
  onDisplayNameChange: (value: string) => void;
  onRegistrationNumberChange: (value: string) => void;
  onContactEmailChange: (value: string) => void;
  onContactPhoneChange: (value: string) => void;
  onPatientFacingBioChange: (value: string) => void;
  onSave: () => void;
};

export default function ProfessionalIdentitySettingsCard({
  displayName,
  registrationNumber,
  contactEmail,
  contactPhone,
  patientFacingBio,
  saving,
  onDisplayNameChange,
  onRegistrationNumberChange,
  onContactEmailChange,
  onContactPhoneChange,
  onPatientFacingBioChange,
  onSave,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Identificação exibida ao paciente</CardTitle>
        <CardDescription>
          Somente os dados abaixo podem ser apresentados às pessoas que
          autorizaram seu acompanhamento. Preferências internas e modelos de
          mensagem permanecem privados.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Nome profissional</span>
            <Input
              value={displayName}
              onChange={event => onDisplayNameChange(event.target.value)}
              maxLength={120}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Registro profissional</span>
            <Input
              value={registrationNumber}
              onChange={event => onRegistrationNumberChange(event.target.value)}
              maxLength={80}
              placeholder="Ex.: CRN 00000"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">E-mail profissional</span>
            <Input
              type="email"
              value={contactEmail}
              onChange={event => onContactEmailChange(event.target.value)}
              maxLength={320}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Telefone profissional</span>
            <Input
              value={contactPhone}
              onChange={event => onContactPhoneChange(event.target.value)}
              maxLength={30}
            />
          </label>
        </div>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Apresentação para o paciente</span>
          <textarea
            className="min-h-28 rounded-md border bg-background p-3"
            value={patientFacingBio}
            onChange={event => onPatientFacingBioChange(event.target.value)}
            maxLength={1000}
          />
        </label>
        <Button
          className="w-fit"
          disabled={saving || displayName.trim().length < 2}
          onClick={onSave}
        >
          <Save className="h-4 w-4" />
          {saving ? "Salvando identificação..." : "Salvar identificação"}
        </Button>
      </CardContent>
    </Card>
  );
}
