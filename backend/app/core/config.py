from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """
    All settings are automatically read from the .env file.
    If a value is missing in .env, Python will raise an error immediately,
    so we never run the app with missing configuration.
    """
    APP_NAME: str = "Fridge Chef AI"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = True

    GEMINI_API_KEY: str = ""
    DATABASE_URL: str = "sqlite:///./fridgechef.db"

    class Config:
        env_file = "backend/.env"   # Tell Pydantic where to find our .env file
        extra = "ignore"            # Ignore any extra variables in .env


# Create a single 'settings' object that the whole app will use
settings = Settings()
