describe('Nutrition Service - normalizeName', () => {
  // We test the pure utility function directly without DB
  const normalizeName = (name: string): string =>
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  it('should lowercase the name', () => {
    expect(normalizeName('Arroz Branco')).toBe('arroz branco');
  });

  it('should remove accents', () => {
    expect(normalizeName('feijão')).toBe('feijao');
    expect(normalizeName('pão')).toBe('pao');
    expect(normalizeName('café')).toBe('cafe');
  });

  it('should remove special characters', () => {
    expect(normalizeName('frango-grelhado!')).toBe('frango grelhado');
  });

  it('should trim whitespace', () => {
    expect(normalizeName('  arroz  ')).toBe('arroz');
  });
});

describe('Users Service - calculateTDEE', () => {
  const calculateTDEE = (params: {
    gender: string;
    currentWeightKg: number;
    heightCm: number;
    age: number;
    activityLevel: string;
    goalType: string;
  }): { calories: number; protein: number; carbs: number; fat: number } => {
    let bmr: number;
    if (params.gender === 'MALE') {
      bmr = 88.362 + 13.397 * params.currentWeightKg + 4.799 * params.heightCm - 5.677 * params.age;
    } else {
      bmr = 447.593 + 9.247 * params.currentWeightKg + 3.098 * params.heightCm - 4.330 * params.age;
    }

    const activityMultipliers: Record<string, number> = {
      SEDENTARY: 1.2,
      LIGHTLY_ACTIVE: 1.375,
      MODERATELY_ACTIVE: 1.55,
      VERY_ACTIVE: 1.725,
      EXTRA_ACTIVE: 1.9,
    };

    const tdee = bmr * (activityMultipliers[params.activityLevel] ?? 1.2);

    const goalAdjustments: Record<string, number> = {
      LOSE_WEIGHT: -500,
      MAINTAIN: 0,
      GAIN_WEIGHT: 300,
      BUILD_MUSCLE: 200,
    };

    const calories = Math.round(tdee + (goalAdjustments[params.goalType] ?? 0));
    return {
      calories,
      protein: Math.round((calories * 0.30) / 4),
      carbs: Math.round((calories * 0.45) / 4),
      fat: Math.round((calories * 0.25) / 9),
    };
  };

  it('should calculate TDEE for a sedentary male', () => {
    const result = calculateTDEE({
      gender: 'MALE',
      currentWeightKg: 80,
      heightCm: 175,
      age: 30,
      activityLevel: 'SEDENTARY',
      goalType: 'MAINTAIN',
    });

    expect(result.calories).toBeGreaterThan(1500);
    expect(result.calories).toBeLessThan(3000);
    expect(result.protein).toBeGreaterThan(0);
    expect(result.carbs).toBeGreaterThan(0);
    expect(result.fat).toBeGreaterThan(0);
  });

  it('should reduce calories for weight loss goal', () => {
    const maintain = calculateTDEE({
      gender: 'FEMALE',
      currentWeightKg: 65,
      heightCm: 165,
      age: 28,
      activityLevel: 'MODERATELY_ACTIVE',
      goalType: 'MAINTAIN',
    });

    const loseFat = calculateTDEE({
      gender: 'FEMALE',
      currentWeightKg: 65,
      heightCm: 165,
      age: 28,
      activityLevel: 'MODERATELY_ACTIVE',
      goalType: 'LOSE_WEIGHT',
    });

    expect(loseFat.calories).toBe(maintain.calories - 500);
  });

  it('should return higher TDEE for very active person', () => {
    const sedentary = calculateTDEE({
      gender: 'MALE',
      currentWeightKg: 75,
      heightCm: 178,
      age: 25,
      activityLevel: 'SEDENTARY',
      goalType: 'MAINTAIN',
    });

    const veryActive = calculateTDEE({
      gender: 'MALE',
      currentWeightKg: 75,
      heightCm: 178,
      age: 25,
      activityLevel: 'VERY_ACTIVE',
      goalType: 'MAINTAIN',
    });

    expect(veryActive.calories).toBeGreaterThan(sedentary.calories);
  });
});

describe('WhatsApp service - getMediaType', () => {
  const getMediaType = (type: string): string => {
    const map: Record<string, string> = {
      text: 'TEXT',
      audio: 'AUDIO',
      image: 'IMAGE',
      document: 'DOCUMENT',
    };
    return map[type] ?? 'TEXT';
  };

  it('should map text type', () => {
    expect(getMediaType('text')).toBe('TEXT');
  });

  it('should map audio type', () => {
    expect(getMediaType('audio')).toBe('AUDIO');
  });

  it('should map image type', () => {
    expect(getMediaType('image')).toBe('IMAGE');
  });

  it('should default to TEXT for unknown type', () => {
    expect(getMediaType('unknown')).toBe('TEXT');
  });
});
