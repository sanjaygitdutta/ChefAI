from google.genai import types

def main():
    print("LiveClientContent fields:")
    for name, field in types.LiveClientContent.model_fields.items():
        print(f"  {name}: {field.annotation}")
    print("\nToolResponse fields:")
    for name, field in types.ToolResponse.model_fields.items():
        print(f"  {name}: {field.annotation}")

if __name__ == "__main__":
    main()